import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { applyTheme, loadTheme } from './ui/theme';

applyTheme(loadTheme());

document.title = __APP_NAME__;
createRoot(document.getElementById('root')!).render(<App />);
