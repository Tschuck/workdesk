import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installTooltips } from './tooltips'
import { applyTheme, storedThemeId } from './theme'

// before the first paint: the chosen theme, not Gruvbox for a moment
applyTheme(storedThemeId())

installTooltips()

createRoot(document.getElementById('root')!).render(<App />)
