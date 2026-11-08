import { spawnSync } from "node:child_process";

// Runs every test file and fails if any check fails. Usage: npm test
const files = ["pipeline", "sizes", "saved", "legal", "limit"];
let passed = 0;
let failed = 0;
for (const name of files) {
  const run = spawnSync("npx", ["tsx", `tests/${name}.mts`], { encoding: "utf8", shell: process.platform === "win32" });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const ok = (output.match(/^PASS /gm) ?? []).length;
  const bad = (output.match(/^FAIL /gm) ?? []).length;
  passed += ok; failed += bad;
  const crashed = run.status !== 0 && bad === 0;
  if (crashed) failed++;
  console.log(`${bad || crashed ? "FAIL" : "ok  "}  ${name.padEnd(9)} ${ok} passed${bad ? `, ${bad} failed` : ""}${crashed ? " (the file crashed)" : ""}`);
  if (bad || crashed) console.log(output.split("\n").filter((line) => /^FAIL |Error|error/.test(line)).slice(0, 12).join("\n"));
}
console.log(`\n${failed ? `${failed} FAILED` : "All checks passed"}: ${passed} passed across ${files.length} files`);
process.exit(failed ? 1 : 0);
