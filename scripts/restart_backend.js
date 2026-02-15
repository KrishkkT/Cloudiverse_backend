const { exec } = require('child_process');

const PORT = 5000;

const getProcessId = () => {
    return new Promise((resolve, reject) => {
        const cmd = process.platform === 'win32'
            ? `netstat -ano | findstr :${PORT}`
            : `lsof -i :${PORT} -t`;

        exec(cmd, (err, stdout) => {
            if (err) return resolve(null);

            const lines = stdout.trim().split('\n');
            if (lines.length === 0) return resolve(null);

            if (process.platform === 'win32') {
                const parts = lines[0].trim().split(/\s+/);
                const pid = parts[parts.length - 1]; // PID is last column
                resolve(pid);
            } else {
                resolve(lines[0].trim());
            }
        });
    });
};

const killProcess = (pid) => {
    return new Promise((resolve, reject) => {
        const cmd = process.platform === 'win32'
            ? `taskkill /PID ${pid} /F`
            : `kill -9 ${pid}`;

        exec(cmd, (err) => {
            if (err) console.log(`Failed to kill ${pid}: ${err.message}`);
            else console.log(`Killed process ${pid}`);
            resolve();
        });
    });
};

const startBackend = () => {
    console.log('Starting backend server...');
    const child = require('child_process').spawn('node', ['server.js'], {
        stdio: 'inherit',
        detached: true,
        cwd: __dirname + '/../' // Assumes script is in backend/scripts
    });
    child.unref();
    console.log('Backend server started in background.');
};

(async () => {
    try {
        const pid = await getProcessId();
        if (pid) {
            console.log(`Found backend on port ${PORT} with PID ${pid}. Killing...`);
            await killProcess(pid);
            // Wait a sec for port to free
            await new Promise(r => setTimeout(r, 2000));
        } else {
            console.log(`No process found on port ${PORT}.`);
        }
        startBackend();
    } catch (e) {
        console.error(e);
    }
})();
