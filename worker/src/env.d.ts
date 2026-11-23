// Wrangler imports .html files as text (default module rules).
declare module "*.html" {
  const text: string;
  export default text;
}
