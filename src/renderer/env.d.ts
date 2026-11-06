/// <reference types="vite/client" />
import type React from 'react'
import type { WorkDeskApi } from '../shared/api'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string }
    }
  }

  interface Window {
    workdesk: WorkDeskApi
  }
}

// React 19 reads its elements from its own JSX namespace: the extension buttons (electron-chrome-extensions)
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'browser-action-list': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { partition?: string; tab?: string; alignment?: string }
    }
  }
}
