// Photos, comments, reactions and the missed-days note (D14–D16).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-supabase.js');

// Capture pushes instead of sending them.
const sent = [];
const pushPath = require.resolve('../src/services/push.js');
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true,
  exports: {
    isEnabled: () => true,
    sendToAuthUsers: async (ids, payload) => { sent.push({ ids: [...ids], ...payload }); return ids.length; },
  },
};

const notifier = require('../src/notifier.js');
const { handlePhoto, FLEX_RE } = require('../src/handlers/photos.js');

const OWNER = 4242;
const OWNER_AUTH = 'owner-auth';
const FRIEND_AUTH = 'friend-auth';
let db;

beforeEach(() => {
  fake.reset();
  db = fake.state.db;
  sent.length = 0;
  notifier._lastReactionPush.clear();
  db.users.push({ telegram_user_id: OWNER, auth_user_id: OWNER_AUTH, first_name: 'فيصل' });
  db.coach_settings.push({ ...fake.SETTINGS_DEFAULTS, user_id: OWNER, coach_enabled: true, start_weight: 112, goal_weight: 90 });
  db.watchers.push({ owner_user_id: OWNER, watcher_auth_user_id: FRIEND_AUTH, display_name: 'سعد' });
});

test('recipientsFor: friend → owner, owner → watchers', () => {
  const owner = { authId: OWNER_AUTH, watchers: [{ authId: FRIEND_AUTH }, { authId: 'other' }] };
  assert.deepEqual(notifier.recipientsFor(owner, FRIEND_AUTH), [OWNER_AUTH]);
  assert.deepEqual(notifier.recipientsFor(owner, OWNER_AUTH), [FRIEND_AUTH, 'other']);
});

test('comments push once each and get marked', async () => {
  db.feed_comments.push(
    { id: 1, owner_user_id: OWNER, item_kind: 'meal', item_ref: '7', author_auth_user_id: FRIEND_AUTH, body: 'وش ذا؟ 😂', created_at: '2026-11-12T10:00:00Z', notified_at: null },
    { id: 2, owner_user_id: OWNER, item_kind: 'meal', item_ref: '7', author_auth_user_id: OWNER_AUTH, body: 'سلطة يا رجال', created_at: '2026-11-12T10:01:00Z', notified_at: null },
  );
  assert.equal(await notifier.processComments(), 2);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].ids, [OWNER_AUTH]);
  assert.equal(sent[0].title, 'سعد علّق على وجبتك');
  assert.equal(sent[0].url, '/feed?item=meal%3A7');
  assert.deepEqual(sent[1].ids, [FRIEND_AUTH]);
  assert.equal(sent[1].title, 'فيصل رد عليك');
  assert.ok(db.feed_comments.every((c) => c.notified_at));
  assert.equal(await notifier.processComments(), 0);
});

test('reactions: batched to one push per 30 minutes', async () => {
  const add = (ref, emoji) => db.feed_reactions.push({
    owner_user_id: OWNER, item_kind: 'day', item_ref: ref, author_auth_user_id: FRIEND_AUTH,
    emoji, created_at: new Date().toISOString(), notified_at: null,
  });
  add('2026-11-12', '🔥');
  const t0 = Date.parse('2026-11-12T10:00:00Z');
  await notifier.processReactions(t0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'سعد حط 🔥 على يومك');

  add('2026-11-11', '💪');
  add('2026-11-10', '👏');
  await notifier.processReactions(t0 + 10 * 60 * 1000); // inside window → wait
  assert.equal(sent.length, 1);
  await notifier.processReactions(t0 + 31 * 60 * 1000);
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /^2 تفاعلات جديدة/);
  assert.ok(db.feed_reactions.every((r) => r.notified_at));
});

test('owner reacting to own feed is silent', async () => {
  db.feed_reactions.push({ owner_user_id: OWNER, item_kind: 'day', item_ref: 'x', author_auth_user_id: OWNER_AUTH, emoji: '🔥', created_at: 'z', notified_at: null });
  await notifier.processReactions(Date.now());
  assert.equal(sent.length, 0);
  assert.ok(db.feed_reactions[0].notified_at);
});

test('missed days: 3 quiet days → one feed event + one push per gap; respects quiet hours and pause', async () => {
  db.weight_entries.push({ user_id: OWNER, weight: 111, recorded_at: '2026-11-09' });
  const noon = new Date('2026-11-12T09:00:00Z'); // 12:00 Riyadh, 3 days after 11-09
  assert.equal(await notifier.processMissedDays(noon), 1);
  assert.equal(db.feed_events.length, 1);
  assert.equal(db.feed_events[0].gap_key, '2026-11-09');
  assert.deepEqual(sent[0].ids, [FRIEND_AUTH]);
  assert.equal(sent[0].title, 'فيصل غايب من ٣ أيام');

  assert.equal(await notifier.processMissedDays(new Date('2026-11-12T12:00:00Z')), 0); // same gap
  assert.equal(sent.length, 1);

  fake.reset(); db = fake.state.db; sent.length = 0;
  db.users.push({ telegram_user_id: OWNER, auth_user_id: OWNER_AUTH, first_name: 'فيصل' });
  db.coach_settings.push({ ...fake.SETTINGS_DEFAULTS, user_id: OWNER, coach_enabled: true, start_weight: 112, goal_weight: 90 });
  db.watchers.push({ owner_user_id: OWNER, watcher_auth_user_id: FRIEND_AUTH });
  db.weight_entries.push({ user_id: OWNER, weight: 111, recorded_at: '2026-11-09' });
  assert.equal(await notifier.processMissedDays(new Date('2026-11-12T22:00:00Z')), 0); // 01:00 Riyadh, quiet
  db.coach_settings[0].paused_until = '2026-11-20';
  assert.equal(await notifier.processMissedDays(noon), 0);
  assert.equal(sent.length, 0);
});

test('photo: meal post by default, flex with «فليكس» caption; non-coach ignored', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const ctx = (caption, id = OWNER) => {
    const replies = [];
    return {
      from: { id },
      message: { photo: [{ file_id: 'small' }, { file_id: 'big' }], caption },
      telegram: { getFileLink: async (f) => `https://t/${f}` },
      replies,
      reply: async (t) => replies.push(t),
    };
  };
  try {
    const m = ctx('غدا');
    await handlePhoto(m);
    assert.equal(db.meal_posts.length, 1);
    assert.equal(db.meal_posts[0].caption, 'غدا');
    assert.equal(db.meal_posts[0].source, 'telegram');
    assert.match(db.meal_posts[0].storage_path, new RegExp(`^${OWNER}/\\d{4}-\\d{2}-\\d{2}/[0-9a-f-]+\\.jpg$`));
    assert.ok(fake.state.storage[`meal-photos/${db.meal_posts[0].storage_path}`]);
    assert.match(m.replies[0], /صاحبك بيشوفها/);

    const f = ctx('فليكس الأسبوع ٢');
    await handlePhoto(f);
    assert.equal(db.flex_posts.length, 1);
    assert.equal(db.flex_posts[0].caption, 'الأسبوع ٢');
    assert.equal(db.flex_posts[0].shared_with_watchers, false);
    assert.equal(db.flex_photos.length, 1);
    assert.equal(db.flex_photos[0].post_id, db.flex_posts[0].id);
    assert.match(f.replies[0], /خاص لك/);

    db.users.push({ telegram_user_id: 99 });
    const n = ctx('غدا', 99);
    await handlePhoto(n);
    assert.equal(n.replies.length, 0);
    assert.equal(db.meal_posts.length, 1);
  } finally {
    global.fetch = realFetch;
  }
  assert.ok(FLEX_RE.test('flex: week 2'));
  assert.ok(!FLEX_RE.test('flexible lunch'));
});

test('photo album with «فليكس» → one flex post, max 4 photos, one reply', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
  const replies = [];
  const ctxAlbum = (caption) => ({
    from: { id: OWNER },
    message: { photo: [{ file_id: 'p' }], caption, media_group_id: 'album-1' },
    telegram: { getFileLink: async (f) => `https://t/${f}` },
    reply: async (t) => replies.push(t),
  });
  try {
    // Telegram puts the caption on the first message only; updates may be handled concurrently.
    await Promise.all([ctxAlbum('فليكس'), ctxAlbum(), ctxAlbum(), ctxAlbum(), ctxAlbum()].map((c) => handlePhoto(c)));
    assert.equal(db.flex_posts.length, 1);
    assert.equal(db.flex_photos.length, 4);
    assert.deepEqual(db.flex_photos.map((p) => p.position), [0, 1, 2, 3]);
    assert.equal(db.meal_posts.length, 0);
    assert.equal(replies.filter((r) => /حفظت الفليكس/.test(r)).length, 1);
    assert.ok(replies.some((r) => /٤ صور بس|4 صور بس/.test(r)));
  } finally {
    global.fetch = realFetch;
  }
});
