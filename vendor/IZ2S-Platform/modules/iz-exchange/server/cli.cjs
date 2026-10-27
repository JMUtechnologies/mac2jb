const {main}=require('./games.cjs');
if(require.main===module){const [run,title]=process.argv.slice(2);if(!run)throw Error('Usage: node modules/iz-exchange/server/cli.cjs /absolute/path/to/held-fs-run [title-id]');main(run,title).catch(error=>{console.error(error.message);process.exitCode=1;});}
