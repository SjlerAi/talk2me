'use strict';
// Passenger loads this module as a bootstrap; do not depend on require.main.
require('./server').start().catch(error=>{
 console.error('[zippy] Passenger startup failed',error.code||error.message);
 process.exitCode=1;
});
