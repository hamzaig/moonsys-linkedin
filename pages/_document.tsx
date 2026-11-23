import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" data-theme="moonsys">
      <Head>
        <meta name="theme-color" content="#f8abbd" />
        <link rel="preload" href="/brand/fonts/Inter-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/brand/fonts/Mulish-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="icon" type="image/x-icon" href="/brand/favicon.ico" />
        <link rel="icon" type="image/png" href="/brand/moonsys-mark.png" />
        <link rel="apple-touch-icon" href="/brand/moonsys-mark.png" />
      </Head>
      <body className="min-h-screen bg-base-100 text-base-content antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
