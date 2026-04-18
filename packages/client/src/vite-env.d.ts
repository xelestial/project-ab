/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend server port for dev mode (e.g. "3001"). Default: "3000" */
  readonly VITE_SERVER_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
