import { execSync } from "child_process";`ntry {`n  execSync("npx tsc", { stdio: "inherit" });`n} catch (e) {`n  console.log("TypeScript compilation finished with errors, but continuing...");`n}
