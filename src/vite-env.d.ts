/// <reference types="vite/client" />

/** Modelo de exemplo privado embutido no build (ou null). */
declare const __EXAMPLE__: import('./engine/types').Model | null;
declare const __APP_NAME__: string;
declare const __EXAMPLE_MAIN__: import('./engine/types').Model | null;
/** Build offline (SIM_OFFLINE=1): linha de 10 postos aberta e tema cinza e verde. */
declare const __OFFLINE__: boolean;
/** Link do projeto online (private/online-url.txt), usado no botão da versão offline. */
declare const __ONLINE_URL__: string;
