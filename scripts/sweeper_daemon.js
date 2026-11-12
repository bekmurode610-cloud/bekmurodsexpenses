const { exec } = require('child_process');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');

function sweep() {
  const cmd = `npx tgcloud run endpoints/check_duty "{}"`;
  exec(cmd, { cwd: projectDir }, (err, stdout, stderr) => {
    const time = new Date().toLocaleTimeString();
    if (err) {
      console.warn(`[${time}] Sweeper error:`, err.message);
    } else {
      const match = stdout.match(/< (\{.*\})/);
      const res = match ? match[1] : '';
      console.log(`[${time}] Swept:`, res);
    }
  });
}

// Run immediately on start
sweep();

// Run every 20 seconds
setInterval(sweep, 20000);
