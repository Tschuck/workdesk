import { describe, expect, it } from 'vitest'
import { buildSnapshot, descendants, parseCodeStatus, parseCpuTime, parsePs, type ProcRow } from './performance'

const row = (pid: number, ppid: number, rssMb: number, command: string, cpuSeconds = 0): ProcRow => ({ pid, ppid, rssKb: rssMb * 1024, cpuSeconds, command })

describe('Performance', () => {
  it('reads ps output and CPU times', () => {
    expect(parseCpuTime('0:12.50')).toBe(12.5)
    expect(parseCpuTime('1:02:03.00')).toBe(3723)
    expect(parseCpuTime('2-00:00:01.00')).toBe(172_801)
    expect(parsePs('  10     1  2048   0:01.00 /Applications/Some App.app/Contents/MacOS/App\nbroken\n 11 10 100 0:00.10 /bin/zsh\n')).toEqual([
      { pid: 10, ppid: 1, rssKb: 2048, cpuSeconds: 1, command: '/Applications/Some App.app/Contents/MacOS/App' },
      { pid: 11, ppid: 10, rssKb: 100, cpuSeconds: 0.1, command: '/bin/zsh' }
    ])
  })

  it('finds everything below a process, and survives a loop', () => {
    const rows = [row(1, 0, 1, 'a'), row(2, 1, 1, 'b'), row(3, 2, 1, 'c'), row(4, 9, 1, 'd')]
    expect(descendants(rows, 1).map((r) => r.pid)).toEqual([1, 2, 3])
    expect(descendants([row(1, 2, 1, 'a'), row(2, 1, 1, 'b')], 1)).toHaveLength(2)
    expect(descendants(rows, 77)).toEqual([])
  })

  it('splits the machine into the app, each WorkDesk, VS Code, the usage reader and tmux', () => {
    const rows = [
      row(100, 1, 200, '/Applications/WorkDesk.app/Contents/MacOS/WorkDesk'),
      row(101, 100, 300, '/Applications/WorkDesk.app/Contents/Frameworks/WorkDesk Helper (Renderer)'),
      row(200, 1, 5, '/usr/local/bin/tmux'),
      row(210, 200, 10, '/bin/zsh'),
      row(211, 210, 400, '/usr/local/bin/claude', 50),
      row(220, 200, 10, '/bin/zsh'),
      row(230, 200, 100, '/usr/local/bin/claude'),
      row(300, 1, 500, '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'),
      row(999, 1, 70, '/usr/sbin/other')
    ]
    const snap = buildSnapshot({
      rows,
      appPid: 100,
      tmuxPid: 200,
      panes: [
        { session: 'workdesk-a', window: 'p1', pid: 210 },
        { session: 'workdesk-view-a-p1', window: 'p1', pid: 210 },
        { session: 'workdesk-b', window: 'p2', pid: 220 },
        { session: '_workdesk-usage', window: 'u', pid: 230 }
      ],
      desks: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Idle' }],
      cpuOf: (p) => (p.pid === 211 ? 12.34 : 0),
      now: 5
    })
    expect(snap.app).toMatchObject({ processes: 2, memoryMb: 500, cpu: 0, parts: [] })
    expect(snap.desks.map((d) => [d.name, d.memoryMb, d.terminals, d.cpu])).toEqual([['Alpha', 410, 1, 12.3], ['Beta', 10, 1, 0], ['Idle', 0, 0, 0]])
    expect(snap.desks[0].tree).toHaveLength(1)
    expect(snap.desks[0].tree[0]).toMatchObject({ window: 'p1', processes: 2, memoryMb: 410 })
    expect(snap.desks[0].tree[0].root).toMatchObject({ pid: 210, name: 'zsh', children: [{ pid: 211, name: 'claude', memoryMb: 400, cpu: 12.3, children: [], more: 0 }] })
    expect(snap.desks[0].top[0]).toEqual({ name: 'claude', memoryMb: 400, cpu: 12.3 })
    expect(snap.usage.memoryMb).toBe(100)
    expect(snap.editor).toMatchObject({ processes: 1, memoryMb: 500, cpu: 0, windows: [] })
    expect(snap.tmuxServer.processes).toBe(1)
    // 'other' belongs to nobody; the view session is not counted twice
    expect(snap.total).toMatchObject({ processes: 9 - 1, memoryMb: 200 + 300 + 5 + 10 + 400 + 10 + 100 + 500 })
  })

  const STATUS = [
    'Version:          Code 1.141.0',
    'GPU Status:       2d_canvas: enabled',
    'CPU %\tMem MB\t   PID\tProcess',
    '    0\t5629499534\t  2590\t   gpu-process',
    '    0\t8444249301\t  2689\tshared-process',
    '    0\t14073748836\t 31203\twindow [10] (bruno-flows (Workspace))',
    '    0\t5629499534\t 31257\tfile-watcher [10]',
    '    0\t8444249301\t 31280\textension-host [10]',
    '    0\t2814749767\t 31328\t     /Applications/Visual Studio Code.app/x/Code Helper (Plugin) /y/main.cjs --clientProcessId=31280',
    '    0\t19703248370\t 59727\twindow [13] (main (Workspace))',
    '    0\t8444249301\t 59878\textension-host [13]',
    '    0\t2814749767\t 78655\tpty-host',
    ''
  ].join('\n')

  it('reads the windows of `code --status`, with the processes that belong to each', () => {
    expect(parseCodeStatus(STATUS)).toEqual([
      { title: 'bruno-flows (Workspace)', pids: [31203, 31257, 31280] },
      { title: 'main (Workspace)', pids: [59727, 59878] }
    ])
    expect(parseCodeStatus('no table here')).toEqual([])
  })

  it('groups VS Code by window title, and keeps what is shared apart', () => {
    const code = '/Applications/Visual Studio Code.app/Contents/MacOS/'
    const rows = [
      row(2590, 1, 100, code + 'Electron'),
      row(2689, 2590, 50, code + 'shared'),
      row(31203, 2590, 300, code + 'window'),
      row(31280, 2590, 80, code + 'ext'),
      row(31328, 31280, 20, code + 'plugin'),
      row(59727, 2590, 200, code + 'window'),
      row(78655, 2590, 5, code + 'pty')
    ]
    const snap = buildSnapshot({
      rows, appPid: 1, panes: [], desks: [], cpuOf: () => 0, now: 1,
      codeWindows: [{ title: 'bruno-flows (Workspace)', pids: [31203, 31280] }, { title: 'main (Workspace)', pids: [59727] }]
    })
    expect(snap.editor.windows.map((w) => [w.title, w.processes, w.memoryMb])).toEqual([['bruno-flows (Workspace)', 3, 400], ['main (Workspace)', 1, 200]])
    expect(snap.editor.shared).toMatchObject({ processes: 3, memoryMb: 155 })
    expect(snap.editor).toMatchObject({ processes: 7, memoryMb: 755 })
  })
})
