module.exports = {
  apps: [
    {
      name: 'opportunity-radar',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '4173',
      },
    },
  ],
}
