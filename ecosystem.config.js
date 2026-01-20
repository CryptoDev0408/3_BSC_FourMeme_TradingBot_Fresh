module.exports = {
	apps: [{
		name: 'fourmeme-bot',
		script: './dist/index.js',
		instances: 1,
		exec_mode: 'fork',
		watch: false,
		max_memory_restart: '500M',
		env: {
			NODE_ENV: 'production',
		},
		error_file: './logs/error.log',
		out_file: './logs/output.log',
		log_file: './logs/combined.log',
		time: true,
		autorestart: true,
		max_restarts: 10,
		min_uptime: '10s',
		restart_delay: 5000,
		kill_timeout: 5000,
		listen_timeout: 3000,
		shutdown_with_message: true,
		// Graceful shutdown
		wait_ready: true,
		// Advanced PM2 features
		merge_logs: true,
		log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
		// Cron restart (optional - restart daily at 4 AM)
		// cron_restart: '0 4 * * *',
	}, ],
};