#!/usr/bin/env node
/**
 * Uptime Monitor for Perry's Client Sites
 * Runs continuously, checks sites, alerts on issues, triggers DR plan
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'state.json');

let config = {};
let state = {
  lastAlerts: {},
  siteStatus: {},
  startTime: new Date().toISOString()
};

function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    console.log(`[${timestamp()}] Loaded config: ${config.sites.length} sites to monitor`);
  } catch (err) {
    console.error(`[${timestamp()}] Failed to load config:`, err.message);
    process.exit(1);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
    }
  } catch (err) {
    console.log(`[${timestamp()}] Starting with fresh state`);
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(`[${timestamp()}] Failed to save state:`, err.message);
  }
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function log(message) {
  const line = `[${timestamp()}] ${message}`;
  console.log(line);

  if (config.logFile) {
    try {
      fs.appendFileSync(config.logFile, line + '\n');
    } catch (err) {
      // Ignore log write errors
    }
  }
}

function checkSite(site) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const url = new URL(site.url);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get(site.url, { timeout: site.timeout || 15000 }, (res) => {
      const responseTime = Date.now() - startTime;
      const expected = site.expectedStatus || 200;
      const success = Array.isArray(expected)
        ? expected.includes(res.statusCode)
        : res.statusCode === expected;
      resolve({
        site: site.name,
        url: site.url,
        status: res.statusCode,
        responseTime,
        success,
        timestamp: new Date().toISOString()
      });
    });

    req.on('error', (err) => {
      resolve({
        site: site.name,
        url: site.url,
        status: 0,
        error: err.message,
        responseTime: Date.now() - startTime,
        success: false,
        timestamp: new Date().toISOString()
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        site: site.name,
        url: site.url,
        status: 0,
        error: 'Timeout',
        responseTime: site.timeout || 15000,
        success: false,
        timestamp: new Date().toISOString()
      });
    });
  });
}

function playAlertSound() {
  if (!config.notifications?.sound) return;

  // Use PowerShell to play system alert sound (safe - no user input)
  const soundPath = 'C:\\Windows\\Media\\Windows Critical Stop.wav';
  const script = `(New-Object Media.SoundPlayer '${soundPath}').PlaySync()`;

  spawn('powershell', ['-c', script], { stdio: 'ignore' });
}

function openDRPlan(drPlanPath) {
  if (drPlanPath && fs.existsSync(drPlanPath)) {
    log(`Opening DR Plan: ${drPlanPath}`);
    // Use start command via cmd to open file with default app
    spawn('cmd', ['/c', 'start', '""', drPlanPath], { stdio: 'ignore', shell: false });
  }
}

async function sendEmailAlert(site, result) {
  if (!config.notifications?.email) return;

  const subject = `SITE DOWN: ${site.name}`;
  const body = [
    'UPTIME ALERT - Site Down',
    '',
    `Site: ${site.name}`,
    `URL: ${site.url}`,
    `Status: ${result.status || 'No Response'}`,
    `Error: ${result.error || 'N/A'}`,
    `Response Time: ${result.responseTime}ms`,
    `Priority: ${site.priority || 'medium'}`,
    `Time: ${result.timestamp}`,
    '',
    site.drPlan ? `DR Plan: ${site.drPlan}` : '',
    '',
    '---',
    'Automated alert from Uptime Monitor'
  ].join('%0A');

  // Open mailto link (safe - controlled input)
  const mailto = `mailto:${config.notifications.emailTo}?subject=${encodeURIComponent(subject)}&body=${body}`;
  spawn('cmd', ['/c', 'start', '""', mailto], { stdio: 'ignore', shell: false });
  log(`Email alert triggered for ${site.name}`);
}

function showNotification(title, message) {
  // Use PowerShell toast notification (safe - sanitized input)
  const safeTitle = title.replace(/['"]/g, '');
  const safeMessage = message.replace(/['"]/g, '');

  const script = `
Add-Type -AssemblyName System.Windows.Forms
$balloon = New-Object System.Windows.Forms.NotifyIcon
$balloon.Icon = [System.Drawing.SystemIcons]::Warning
$balloon.BalloonTipIcon = 'Error'
$balloon.BalloonTipTitle = '${safeTitle}'
$balloon.BalloonTipText = '${safeMessage}'
$balloon.Visible = $true
$balloon.ShowBalloonTip(10000)
Start-Sleep -Seconds 2
$balloon.Dispose()
`;

  spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'ignore' });
}

async function handleAlert(site, result) {
  const now = Date.now();
  const lastAlert = state.lastAlerts[site.name] || 0;
  const cooldown = config.alertCooldown || 300000; // 5 min default

  // Check cooldown
  if (now - lastAlert < cooldown) {
    log(`Alert cooldown active for ${site.name}, skipping notification`);
    return;
  }

  state.lastAlerts[site.name] = now;
  saveState();

  log(`🚨 ALERT: ${site.name} is DOWN!`);
  log(`   URL: ${site.url}`);
  log(`   Status: ${result.status || 'No Response'}`);
  log(`   Error: ${result.error || 'N/A'}`);
  log(`   Priority: ${site.priority || 'medium'}`);

  // Play alert sound
  playAlertSound();

  // Show Windows notification
  showNotification(
    `${site.name} DOWN`,
    `Status: ${result.status || result.error} | Priority: ${site.priority || 'medium'}`
  );

  // Send email alert
  await sendEmailAlert(site, result);

  // Open DR plan for critical sites
  if (site.priority === 'critical' && site.drPlan) {
    openDRPlan(site.drPlan);
  }
}

function handleRecovery(site, result) {
  if (state.siteStatus[site.name] === false) {
    log(`✅ RECOVERED: ${site.name} is back online (${result.responseTime}ms)`);
    showNotification(
      `${site.name} Recovered`,
      `Site is back online - Response: ${result.responseTime}ms`
    );
  }
}

async function checkAllSites() {
  log('--- Starting health check ---');

  for (const site of config.sites) {
    const result = await checkSite(site);

    if (result.success) {
      const statusIcon = result.responseTime < 1000 ? '✓' : '⚠';
      log(`${statusIcon} ${site.name}: OK (${result.responseTime}ms)`);
      handleRecovery(site, result);
      state.siteStatus[site.name] = true;
    } else {
      log(`✗ ${site.name}: FAILED - ${result.error || `Status ${result.status}`}`);
      await handleAlert(site, result);
      state.siteStatus[site.name] = false;
    }
  }

  saveState();
}

async function runOnce() {
  loadConfig();
  loadState();
  await checkAllSites();
}

async function runContinuous() {
  loadConfig();
  loadState();

  log('='.repeat(50));
  log('Uptime Monitor Started');
  log(`Monitoring ${config.sites.length} sites every ${config.checkInterval / 1000}s`);
  log('='.repeat(50));

  // Initial check
  await checkAllSites();

  // Continuous monitoring
  setInterval(async () => {
    await checkAllSites();
  }, config.checkInterval || 60000);
}

// Handle command line args
const args = process.argv.slice(2);
if (args.includes('--once')) {
  runOnce();
} else {
  runContinuous();
}
