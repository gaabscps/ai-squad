import { discoverProjects } from "./collector/discovery.js";

function main(): void {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error("uso: npm run dump -- <pasta-raiz> [outra-raiz ...]");
    process.exit(1);
  }
  const projects = discoverProjects({ roots });
  console.log(JSON.stringify(projects, null, 2));
}

main();
