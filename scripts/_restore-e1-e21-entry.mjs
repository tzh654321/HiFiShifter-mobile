import { readFileSync, writeFileSync } from "node:fs";
const path = "upstream-src/frontend/src/components/mobile/MobileTopBar.tsx";
let t = readFileSync(path, "utf8");
if (!t.includes("ProjectSettingsDialog")) {
  const lines = t.split("\n");
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) if (/^import /.test(lines[i])) lastImport = i;
  lines.splice(lastImport + 1, 0,
    'import { ProjectSettingsDialog } from "../layout/ProjectSettingsDialog";',
    'import { StorageSettingsDialog } from "../layout/StorageSettingsDialog";');
  t = lines.join("\n");
}
if (!t.includes("projectSettingsOpen")) {
  const lines = t.split("\n");
  const at = lines.findIndex((l) => /const \[exportOpen, setExportOpen\]/.test(l));
  lines.splice(at + 1, 0,
    '    const [projectSettingsOpen, setProjectSettingsOpen] = React.useState(false);',
    '    const [storageSettingsOpen, setStorageSettingsOpen] = React.useState(false);');
  t = lines.join("\n");
}
if (!t.includes("menu_project_settings")) {
  const lines = t.split("\n");
  const at = lines.findIndex((l) => /menu_file: \[/.test(l));
  lines.splice(at + 1, 0,
    '            { label: t("menu_project_settings"), action: () => setProjectSettingsOpen(true) },',
    '            { sep: true, label: "" },');
  t = lines.join("\n");
}
if (!t.includes("menu_storage_settings")) {
  const lines = t.split("\n");
  const at = lines.findIndex((l) => /menu_options: \[/.test(l));
  lines.splice(at + 1, 0,
    '            { label: t("menu_storage_settings"), action: () => setStorageSettingsOpen(true) },',
    '            { sep: true, label: "" },');
  t = lines.join("\n");
}
if (!t.includes("<ProjectSettingsDialog")) {
  const lines = t.split("\n");
  const at = lines.findIndex((l) => /<ExportAudioDialog/.test(l));
  lines.splice(at, 0,
    '            <ProjectSettingsDialog open={projectSettingsOpen} onOpenChange={setProjectSettingsOpen} />',
    '            <StorageSettingsDialog open={storageSettingsOpen} onOpenChange={setStorageSettingsOpen} />');
  t = lines.join("\n");
}
writeFileSync(path, t, "utf8");
console.log("入口已恢复：" + (t.includes("menu_project_settings") && t.includes("menu_storage_settings")));
