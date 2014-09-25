var EventEmitter = require('events').EventEmitter;
var util = require('util');
var cluster = require('cluster');

module.exports = Process;

function Process(gracenode) {
	EventEmitter.call(this);
	this.gracenode = gracenode;
	this.log = this.gracenode.log.create('process');
	this.config = this.gracenode.config.getOne('cluster');
	
	if (!this.config) {
		// no configurations for cluster mode provided
		this.config = {};
	}	
	
	this.isShutdown = false; // master only	
	this.inClusterMode = this.config.enable || false;
	var CPUNum = require('os').cpus().length;
	var maxClusterNum = this.config.max || CPUNum;
	this.clusterNum = maxClusterNum;

	if (!this.inClusterMode) {
		this.clusterNum = 1;
	}

	this.log.verbose('number of avialable CPU cores:', CPUNum);
	this.log.verbose('cluster mode:', this.inClusterMode);
	this.log.verbose('number of allowed child processes:', this.clusterNum);
}

util.inherits(Process, EventEmitter);

// public
Process.prototype.setup = function () {
	this.log.verbose('setting up the process...');

	this.listeners();

	if (this.inClusterMode && this.clusterNum > 1) {
		this.startClusterMode();
		return;
	}

	// override the configuration
	this.inClusterMode = false;
	
	this.log.info('running the process in none-cluster mode (pid: ' + process.pid + ')');

	this.emit('nocluster.setup');
};

// private	
Process.prototype.startClusterMode = function () {
	if (cluster.isMaster) {
		// set up master process
		return this.setupMaster();
	}

	this.setupWorker();
};

// public
Process.prototype.send = function (msg, worker) {
	if (!this.inClusterMode) {
		return this.log.warn('send() is available only in cluster mode');
	}
	try {
		msg = JSON.stringify(msg);
	} catch (e) {

	}
	if (worker) {
		// id worker is given, the master sends message to the given worker only
		worker.send(msg);
		return this.log.info('message sent to worker (pid:' + worker.process.pid + ') (id:' + worker.id + ')', msg);
	}
	if (cluster.isMaster) {
		// send message to all workers
		for (var id in cluster.workers) {
			var workerProcess = cluster.workers[id];
			workerProcess.send(msg);
			this.log.info('message sent to worker (pid:' + workerProcess.process.pid + ') (id:' + id + '): ', msg);
		}
		return;
	}
	// send message to master
	process.send(msg);
	this.log.info('message sent to master:', msg);
};

// private (master only)
Process.prototype.createWorker = function () {
	// create worker process
	var worker = cluster.fork();
	this.log.info('worker spawned (pid: ' + worker.process.pid + ')');
	// set up message listener for the worker
	var that = this;
	worker.on('message', function (data) {
		try {
			data = JSON.parse(data);
		} catch (e) {
			
		}
		
		that.log.info('message received from worker (pid:' + worker.process.pid + ') (id:' + worker.id + '):', data);

		that.gracenode.emit('worker.message', worker, data);
	});
	this.log.verbose('worker message listener set up complete: (pid:' + worker.process.pid + ') (id:' + worker.id + ')');
	return worker;
};

//private
Process.prototype.setupMaster = function () {
	this.gracenode._isMaster = true;
	this.gracenode.log._setInternalPrefix('MASTER:' + process.pid);
	this.log = this.gracenode.log.create('process');

	this.log.info('running the process in cluster mode [master] (pid: ' + process.pid + ')');
	this.log.info('number of child processes to be spawned:', this.clusterNum);
	
	var that = this;

	// spawn workers
	for (var i = 0; i < this.clusterNum; i++) {
		this.createWorker();
	}

	// set up termination listener on workers
	cluster.on('exit', function (worker, code, signal) {
		if (!worker.suicide && signal && that.config.autoSpawn) {
			// the worker died from an error, spawn it if allowed by configuration
			var newWorker = that.createWorker();
			return that.log.info('a new worker (pid:' + newWorker.process.pid + ') spawned because a worker has died (pid:' + worker.process.pid + ')');
		}
		that.log.info('worker has died (pid: ' + worker.process.pid + ') [signal: ' + signal + '] code: ' + code, '(suicide:' + worker.suicide + ') (workers:' + Object.keys(cluster.workers).length + ')');	
		// if all child processes are gone and if master is in shutting down mode, we shutdown
		if (noMoreWorkers()) {
			// no more workers and we are shutting down mode OR no more workers and we have workers dying with code greater than 1
			if (that.isShutdown || code) {
				that.log.info('all child processes have gracefully disconnected: exiting master process...');
				that.emit('shutdown');
				that.gracenode.exit();
			}
		}
	});
	
	this.log.info('master has been set up');

	this.emit('cluster.master.setup', process.pid);
};

// private 
Process.prototype.setupWorker = function () {
	this.gracenode._isMaster = false;
	this.gracenode.log._setInternalPrefix('WORKER:' + process.pid);
	this.log = this.gracenode.log.create('child-process');
	this.log.info('running the process in cluster mode [worker] (pid: ' + process.pid + ')');
	this.emit('cluster.worker.setup', process.pid);
	// on disconnect: triggered by master process's cluster.disconnect
	var that = this;
	cluster.worker.on('disconnect', function () {
		that.log.info('worker (pid:' + process.pid + ') has disconnected');
		that.emit('shutdown');
		that.gracenode.exit();
	});
	// set up message lisetner
	process.on('message', function (data) {
		try {
			data = JSON.prase(data);
		} catch (e) {
		
		}
		that.gracenode.emit('master.message', data);
	});
};

// private 
Process.prototype.exit = function (sig) {
	// master process will wait for all child processes to gracefully exit
	if (this.inClusterMode && cluster.isMaster) {
		this.isShutdown = true;
		this.log.info(sig, 'caught: disconnect all child processes');
		// check to see if there is any worker still alive
		if (noMoreWorkers()) {
			// there are no more workers, exit now
			this.log.info('no more workers. exit now...');
			return this.gracenode.exit();
		}
		cluster.disconnect();
		return;
	}
	// none-cluster mode exits gracefully
	if (!this.inClusterMode) {
		this.log.info(sig, 'caught: exiting the application process gracefully');
		this.emit('shutdown');
		this.gracenode.exit();
	}
};

// private
Process.prototype.listeners = function () {

	var that = this;
	
	process.on('SIGINT', function () {
		that.exit('SIGINT');
	});

	process.on('SIGQUIT', function () {
		that.exit('SIGQUIT');
	});

	process.on('SIGTERM', function () {
		that.exit('SIGTERM');
	});

};

// private utility for master process
function noMoreWorkers() {
	return !Object.keys(cluster.workers).length;
}
