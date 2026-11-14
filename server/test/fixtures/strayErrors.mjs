// Test fixture, preloaded into a real server process by process.test.ts: on SIGUSR2 it does
// what a bug somewhere would do, a promise rejected with nobody waiting for it and an error
// thrown with nobody catching it. A healthy server writes both down and keeps running.
process.on('SIGUSR2', () => {
  void Promise.reject(new Error('stray rejection (test)'));
  setTimeout(() => {
    throw new Error('stray exception (test)');
  }, 20);
});
