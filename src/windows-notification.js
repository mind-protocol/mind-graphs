import { spawn } from "node:child_process";

const POWERSHELL_TOAST = String.raw`
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$title = [System.Security.SecurityElement]::Escape($env:MIND_NOTIFY_TITLE)
$body = [System.Security.SecurityElement]::Escape($env:MIND_NOTIFY_BODY)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$appId = $env:MIND_NOTIFY_APP_ID
if ([string]::IsNullOrWhiteSpace($appId)) {
  $appId = (Get-StartApps | Where-Object { $_.Name -match 'Codex|ChatGPT' } | Select-Object -First 1).AppID
}
if ([string]::IsNullOrWhiteSpace($appId)) { throw 'Aucun identifiant d application Codex ou ChatGPT trouvé.' }
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;

export function compactNotificationText(value, maxLength = 360) {
  const text = String(value || "").replace(/[\u0000-\u001f]+/gu, " ").replace(/\s+/gu, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function buildWakeNotification({ codex, codexResult, error, queue, workspace }) {
  const task = queue?.nextTask;
  const title = codex === "completed"
    ? `Codex · ${task ? "tâche terminée" : "réveil terminé"}`
    : codex === "failed" ? "Codex · réveil en erreur" : "Codex · réveil sans exécution";
  const fallback = task
    ? `${task.name || task.id} · workspace v${workspace?.version ?? "?"}`
    : `Aucune tâche autonome · ${queue?.eligibleCount || 0}/${queue?.total || 0} exécutable(s) · workspace v${workspace?.version ?? "?"}`;
  return {
    title: compactNotificationText(title, 80),
    body: compactNotificationText(codexResult || error || fallback)
  };
}

export function showWindowsNotification({
  title,
  body,
  platform = process.platform,
  spawnProcess = spawn,
  appId = process.env.MIND_NOTIFY_APP_ID
}) {
  if (platform !== "win32") return Promise.resolve({ shown: false, reason: "not_windows" });
  return new Promise(resolve => {
    const child = spawnProcess("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", POWERSHELL_TOAST
    ], {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MIND_NOTIFY_TITLE: compactNotificationText(title, 80),
        MIND_NOTIFY_BODY: compactNotificationText(body),
        MIND_NOTIFY_APP_ID: appId || ""
      }
    });
    child.once("error", error => resolve({ shown: false, reason: "spawn_failed", error: error.message }));
    child.once("exit", code => resolve(code === 0
      ? { shown: true }
      : { shown: false, reason: "toast_failed", exitCode: code }));
  });
}
