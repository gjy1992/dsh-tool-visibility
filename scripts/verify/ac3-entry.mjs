/** AC3#0 entry-contract check: importing the host entry must expose apply(). */
import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js').then(m => {
  console.log(typeof m.apply);
  process.exit(typeof m.apply === 'function' ? 0 : 1);
});