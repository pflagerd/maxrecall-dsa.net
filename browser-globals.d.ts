// Names that exist as globals in the browser pages but that TypeScript can't
// see on its own. For make typecheck only (tsconfig.browser.json): a .d.ts
// file only declares; nothing in it runs or is sent to the browser.

// timer.js is a plain <script> on the problem page, so these two functions
// are globals there. TypeScript treats timer.js as a module because of its
// module.exports line (for the tests under Node), so they're declared here,
// taking their types from timer.js's own JSDoc.
declare const createStopwatch: typeof import('./timer').createStopwatch;
declare const formatElapsed: typeof import('./timer').formatElapsed;

// KaTeX's auto-render extension, loaded from cdnjs by problem.html
// (https://katex.org/docs/autorender). Missing when the CDN can't be
// reached, which renderMath() in problem-page.js checks for.
declare const renderMathInElement:
  | ((
      element: HTMLElement,
      options?: {
        delimiters?: { left: string; right: string; display: boolean }[];
        throwOnError?: boolean;
      },
    ) => void)
  | undefined;
