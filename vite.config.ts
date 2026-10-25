import { defineConfig } from "vite";

// GitHub Pages のサブパス（/tsume-board/）でも独自ドメインのルートでも
// 動くように、アセット参照は相対パスにする。
export default defineConfig({
  base: "./",
});
