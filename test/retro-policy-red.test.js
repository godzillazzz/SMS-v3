'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { policyFromSettings, LEAVE_POLICY_KEYS, validateLeavePolicySetting } = require('../src/services/leave-policy.service');

test('supervisor inherits current manager policy until explicitly configured; viewer remains disabled', () => {
 const p = policyFromSettings([{key:LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled,value:'false'},{key:LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack,value:'7'}]);
 assert.equal(p.supervisorRetroactiveOnBehalfEnabled,false);
 assert.equal(p.supervisorRetroactiveMaxDaysBack,7);
 assert.equal(p.viewerRetroactiveSelfEnabled,false);
});

test('independent supervisor and viewer settings validate and resolve', () => {
 const k=LEAVE_POLICY_KEYS;
 const p=policyFromSettings([{key:k.supervisorRetroactiveOnBehalfEnabled,value:'true'},{key:k.supervisorRetroactiveMaxDaysBack,value:'3'},{key:k.viewerRetroactiveSelfEnabled,value:'true'},{key:k.viewerRetroactiveMaxDaysBack,value:'2'}]);
 assert.equal(p.supervisorRetroactiveOnBehalfEnabled,true);
 assert.equal(p.supervisorRetroactiveMaxDaysBack,3);
 assert.equal(p.viewerRetroactiveSelfEnabled,true);
 assert.equal(p.viewerRetroactiveMaxDaysBack,2);
 assert.throws(()=>validateLeavePolicySetting(k.viewerRetroactiveSelfEnabled,'maybe'));
 assert.throws(()=>validateLeavePolicySetting(k.supervisorRetroactiveMaxDaysBack,'-1'));
});
