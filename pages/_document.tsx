import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" data-theme="notion">
      <Head>
        <link rel="icon" type="image/x-icon" href="/logo_moonsys.ico" />
        <link rel="icon" type="image/png" href="/logo_moonsys.png" />
        <link rel="apple-touch-icon" href="/logo_moonsys.png" />
      </Head>
      <body className="min-h-screen bg-base-100 text-base-content antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
