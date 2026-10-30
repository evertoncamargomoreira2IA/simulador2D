import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { isReader, ReaderPage } from './ui/Panel';
import { applyTheme, loadTheme } from './ui/theme';

applyTheme(loadTheme());

document.title = __APP_NAME__;
const root = createRoot(document.getElementById('root')!);
// Quem recebeu o link só como leitor abre direto no painel publicado, sem o editor.
void isReader().then((reader) => root.render(reader ? <ReaderPage /> : <App />));
