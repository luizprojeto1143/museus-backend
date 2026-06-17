import { execSync } from "child_process";
try {
  execSync("npx tsc", { stdio: "inherit" });
} catch (e) {
  console.log("TypeScript compilation finished with errors, but continuing...");
}
