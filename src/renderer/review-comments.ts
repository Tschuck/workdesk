// Review comments inside a Monaco editor: a "+" in the gutter on hover adds one, comments are boxes under their line
// (edit, delete). The comments themselves are kept by the main process (see review-service.ts).
type MonacoApi = (typeof import('./monaco-setup'))['monaco']
type Editor = ReturnType<MonacoApi['editor']['create']>

export interface LineComment {
  id: string
  line: number
  text: string
}

export interface CommentsHost {
  /** the comments of the file shown, now */
  comments: () => LineComment[]
  onAdd: (line: number, text: string) => Promise<void>
  onUpdate: (id: string, text: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onError: (message: string) => void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export interface AttachedComments {
  refresh: () => void
  /** opens the box on `line`: the comment there to edit, or a new one */
  add: (line: number) => void
  dispose: () => void
}

export function attachComments(m: MonacoApi, ed: Editor, host: CommentsHost): AttachedComments {
  let editing: { id?: string; line: number } | undefined
  let zones: string[] = []
  let watchers: ResizeObserver[] = []
  let overlays: { widget: { getId: () => string; getDomNode: () => HTMLElement; getPosition: () => null }; off: { dispose: () => void } }[] = []
  let widgetSeq = 0
  // the form being typed in is kept across redraws (a redraw would lose the text and the focus); what was drawn last tells whether a redraw is needed at all
  let formNode: { key: string; node: HTMLElement; area: HTMLTextAreaElement } | undefined
  let drawn = ''
  let hover = 0
  const deco = ed.createDecorationsCollection([])

  const clearOverlays = () => {
    for (const o of overlays) (o.off.dispose(), ed.removeOverlayWidget(o.widget), o.widget.getDomNode().remove())
    overlays = []
  }

  const fail = (e: unknown) => host.onError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))

  const form = (key: string, initial: string, save: (text: string) => Promise<void>): HTMLElement => {
    if (formNode?.key === key) return formNode.node
    const box = el('div', 'rv-box rv-edit')
    const area = el('textarea')
    area.value = initial
    area.placeholder = 'Describe what needs fixing (⌘Enter saves, Esc cancels)'
    area.rows = Math.max(3, initial.split('\n').length + 1)
    const buttons = el('div', 'rv-buttons')
    const ok = el('button', 'primary', 'Save')
    const cancel = el('button', undefined, 'Cancel')
    const doSave = () => {
      const text = area.value.trim()
      if (!text) return
      ok.disabled = true
      save(text).then(
        () => ((editing = undefined), render()),
        (e) => (fail(e), (ok.disabled = false))
      )
    }
    ok.onclick = doSave
    cancel.onclick = () => ((editing = undefined), render())
    area.onkeydown = (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') ((editing = undefined), render())
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), doSave())
    }
    buttons.append(ok, cancel)
    box.append(area, buttons)
    setTimeout(() => area.focus(), 0)
    formNode = { key, node: box, area }
    return box
  }

  const shown = (c: LineComment): HTMLElement => {
    const box = el('div', 'rv-box')
    box.append(el('div', 'rv-text', c.text))
    const buttons = el('div', 'rv-buttons')
    const edit = el('button', undefined, 'Edit')
    const del = el('button', undefined, 'Delete')
    edit.onclick = () => ((editing = { id: c.id, line: c.line }), render())
    del.onclick = () => void host.onRemove(c.id).then(() => render(), fail)
    buttons.append(edit, del)
    box.append(buttons)
    return box
  }

  function render(): void {
    const comments = host.comments()
    const model = ed.getModel()
    const last = model?.getLineCount() ?? 1
    if (!editing) formNode = undefined
    const sig = JSON.stringify([comments.map((c) => [c.id, c.line, c.text]), editing ? (editing.id ?? `new${editing.line}`) : '', last])
    // nothing changed (the list is read again whenever git is looked at): leave the boxes, and what is typed in them, alone
    if (sig === drawn) return decorate()
    drawn = sig
    const typing = formNode && document.activeElement === formNode.area ? { start: formNode.area.selectionStart, end: formNode.area.selectionEnd } : undefined
    ed.changeViewZones((acc) => {
      for (const id of zones) acc.removeZone(id)
      zones = []
      watchers.forEach((w) => w.disconnect())
      watchers = []
      clearOverlays()
      const add = (line: number, node: HTMLElement) => {
        // The editor takes every click in a view zone for a click in the code, so the zone is only the empty space under the line;
        // the box itself is an overlay widget laid over that space, which gets its clicks and its focus like the editor's own find box.
        const spacer = el('div', 'rv-spacer')
        const box = el('div', 'rv-zone rv-overlay')
        box.append(node)
        // the wheel over something that scrolls in the box (the textarea, a long comment) scrolls that, not the file; at its end, or over a box that does not scroll, the file scrolls
        box.addEventListener(
          'wheel',
          (e) => {
            for (let el = e.target as HTMLElement | null; el; el = el.parentElement) {
              const scrolls = el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)
              if (scrolls && ((e.deltaY < 0 && el.scrollTop > 0) || (e.deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1))) return e.stopPropagation()
              if (el === box) return
            }
          },
          { passive: true }
        )
        const place = () => {
          const l = ed.getLayoutInfo()
          box.style.left = `${l.contentLeft}px`
          box.style.width = `${Math.max(120, l.contentWidth)}px`
        }
        place()
        const after = Math.min(Math.max(line, 0), last)
        // where the space is: under the line, with everything above it (other zones too), less what is scrolled away; read again when any of that changes
        const lay = () => {
          box.style.top = `${(after === 0 ? 0 : ed.getBottomForLineNumber(after)) - ed.getScrollTop()}px`
        }
        lay()
        // one id for its whole life: the editor asks for it again to remove the widget
        const widgetId = `rv-comment-${++widgetSeq}`
        const widget = { getId: () => widgetId, getDomNode: () => box, getPosition: () => null }
        ed.addOverlayWidget(widget)
        const subs = [ed.onDidLayoutChange(place), ed.onDidScrollChange(lay), ed.onDidContentSizeChange(lay)]
        overlays.push({ widget, off: { dispose: () => subs.forEach((d) => d.dispose()) } })
        const zone = {
          afterLineNumber: after,
          heightInPx: 60,
          domNode: spacer,
          // Monaco says where it put the space (not in every kind of editor): then that is the truth
          onDomNodeTop: (top: number) => (box.style.top = `${top}px`)
        }
        const id = acc.addZone(zone)
        zones.push(id)
        // the space follows the height of its box, whenever that changes (first layout, fonts, a textarea the user resizes)
        const fit = () => {
          const h = Math.max(24, Math.ceil(node.getBoundingClientRect().height) + 8)
          if (h === zone.heightInPx) return
          zone.heightInPx = h
          ed.changeViewZones((a) => a.layoutZone(id))
        }
        const watch = new ResizeObserver(fit)
        watch.observe(node)
        watchers.push(watch)
        requestAnimationFrame(() => (fit(), lay()))
      }
      for (const c of comments) {
        if (editing?.id === c.id) add(c.line, form(`edit${c.id}`, c.text, (t) => host.onUpdate(c.id, t)))
        else add(c.line, shown(c))
      }
      if (editing && !editing.id) {
        const line = editing.line
        add(line, form(`new${line}`, '', (t) => host.onAdd(line, t)))
      }
    })
    decorate()
    // the form moved into a new box: it gets the focus and the cursor back
    if (typing && formNode) {
      formNode.area.focus()
      formNode.area.setSelectionRange(typing.start, typing.end)
    }
  }

  /** the gutter: a marker on lines with a comment, a "+" on the line the pointer is over */
  function decorate(): void {
    const comments = host.comments()
    const lines = new Set(comments.map((c) => c.line))
    deco.set([
      ...[...lines].map((l) => ({ range: new m.Range(l, 1, l, 1), options: { glyphMarginClassName: 'rv-glyph-comment', glyphMarginHoverMessage: { value: 'Review comment' } } })),
      ...(hover && !lines.has(hover) ? [{ range: new m.Range(hover, 1, hover, 1), options: { glyphMarginClassName: 'rv-glyph-add' } }] : [])
    ])
  }

  const down = ed.onMouseDown((e) => {
    if (e.target.type !== m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return
    const line = e.target.position.lineNumber
    if (host.comments().some((c) => c.line === line)) return
    editing = { line }
    render()
  })
  const move = ed.onMouseMove((e) => {
    const inGutter = e.target.type === m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || e.target.type === m.editor.MouseTargetType.GUTTER_LINE_NUMBERS
    const next = inGutter && e.target.position ? e.target.position.lineNumber : 0
    if (next !== hover) ((hover = next), decorate())
  })
  const leave = ed.onMouseLeave(() => hover && ((hover = 0), decorate()))
  render()

  return {
    refresh: render,
    add: (line) => {
      editing = { id: host.comments().find((c) => c.line === line)?.id, line }
      render()
    },
    dispose: () => {
      down.dispose()
      move.dispose()
      leave.dispose()
      ed.changeViewZones((acc) => zones.forEach((id) => acc.removeZone(id)))
      zones = []
      watchers.forEach((w) => w.disconnect())
      watchers = []
      clearOverlays()
      deco.clear()
    }
  }
}
