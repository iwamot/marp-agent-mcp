/// <reference types="vite/client" />

// CSS?rawインポートの型定義
declare module "*.css?raw" {
  const content: string;
  export default content;
}
