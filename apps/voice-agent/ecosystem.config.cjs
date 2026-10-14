// pm2: cd /opt/clary/apps/voice-agent && pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'clary-voice',
      cwd: __dirname,
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      kill_timeout: 6000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
