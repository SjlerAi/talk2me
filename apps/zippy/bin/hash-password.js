'use strict';
const {hashPassword}=require('../src/auth');
const password=process.env.ZIPPY_NEW_PASSWORD;if(!password||password.length<14){console.error('Set ZIPPY_NEW_PASSWORD to a unique password of at least 14 characters (never commit it).');process.exitCode=1;}else console.log(hashPassword(password));
