import js from "@eslint/js";
import globals from "globals";
import noUnsanitized from "eslint-plugin-no-unsanitized";

export default [
  js.configs.recommended,
  {
    plugins: {
      "no-unsanitized": noUnsanitized,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "no-unused-vars": ["error", { "args": "none", "varsIgnorePattern": "^removeBookmarks$" }],
    },
  },
];
