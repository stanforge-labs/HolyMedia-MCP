import {test} from 'node:test';import assert from 'node:assert/strict';import {verifiedResourceIdentity as identity} from './provider-identity.mjs';
test('RSA ID derives from verified resource even when ad.id is not selected',()=>{assert.equal(identity('adGroupAd','customers/8590146099/adGroupAds/200180930839~827487091340').id,'827487091340');});
test('compound criteria and campaign asset retain actual parent and identity',()=>{assert.equal(identity('campaignAsset','customers/8590146099/campaignAssets/24339483523~428652751435~SITELINK').parent_id,'24339483523');assert.equal(identity('adGroupCriterion','customers/8590146099/adGroupCriteria/200180930839~2503219799254').id,'2503219799254');});
test('undefined, temporary, foreign resources denied',()=>{for(const x of [undefined,'undefined','customers/8590146099/adGroupAds/-3~-4','customers/9999999999/adGroupAds/1~2'])assert.throws(()=>identity('adGroupAd',x));});

