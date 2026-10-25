import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, htmlToText, itemId, parseDate, parseFeed, trimWords } from './rss.ts';

// NDMA / IMD style: plain RSS 2.0 with CDATA HTML descriptions and an IST pubDate.
const NDMA_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>NDMA Updates</title>
    <link>https://ndma.gov.in</link>
    <item>
      <title>Cyclone alert for Odisha coast</title>
      <link>https://ndma.gov.in/updates/cyclone-odisha</link>
      <description><![CDATA[<p>Heavy rain &amp; gusty winds expected <b>till Thursday</b>.</p>]]></description>
      <pubDate>Tue, 14 Oct 2026 10:00:00 +0530</pubDate>
    </item>
    <!-- a comment between items -->
    <item>
      <title>Advisory on heatwave in Rajasthan</title>
      <link>https://ndma.gov.in/updates/heat</link>
      <description>Hot and dry conditions &#8212; drink water.</description>
      <pubDate>Mon, 13 Oct 2026 08:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

// A news feed: entity-coded punctuation, no CDATA, a description with escaped markup.
const NEWS_RSS = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>Top stories</title>
<item>
<title>Floods in Assam&#8217;s Barpeta district &amp; nearby villages</title>
<link>https://news.example.in/assam-floods?ref=rss&amp;id=7</link>
<description>&lt;p&gt;Water levels rose overnight.&lt;/p&gt; More &amp;lt;later&amp;gt;.</description>
<pubDate>Sun, 12 Oct 2026 21:15:00 +0530</pubDate>
<media:title>ignored media title</media:title>
</item>
<item>
<title>Markets close higher</title>
<link>https://news.example.in/markets</link>
<description>Sensex gained.</description>
</item>
</channel>
</rss>`;

// Atom with self-closing alternate link, an xhtml-free summary and an ISO updated time.
const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Relief desk</title>
  <updated>2026-10-20T08:00:00Z</updated>
  <entry>
    <title type="html">Landslide warning for &lt;em&gt;Uttarakhand&lt;/em&gt;</title>
    <link rel="self" href="https://feeds.example.org/relief.atom"/>
    <link rel="alternate" type="text/html" href="https://relief.example.org/landslide?a=1&amp;b=2"/>
    <id>tag:example.org,2026:1</id>
    <published>2026-10-20T07:45:00+05:30</published>
    <summary type="html">Keep away from slopes &amp; riverbanks.</summary>
  </entry>
  <entry>
    <title>No link entry</title>
    <content type="text">Plain content only.</content>
  </entry>
</feed>`;

test('parses an NDMA-style RSS feed with CDATA, comments and IST dates', () => {
  const items = parseFeed(NDMA_RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Cyclone alert for Odisha coast');
  assert.equal(items[0].link, 'https://ndma.gov.in/updates/cyclone-odisha');
  assert.equal(items[0].summary, 'Heavy rain & gusty winds expected till Thursday.');
  assert.equal(items[0].publishedAt, Date.UTC(2026, 9, 14, 4, 30));
  assert.equal(items[1].summary, 'Hot and dry conditions — drink water.');
  assert.equal(items[1].publishedAt, Date.UTC(2026, 9, 13, 8, 30));
});

test('parses a news feed: entities, escaped markup, namespaced siblings ignored', () => {
  const items = parseFeed(NEWS_RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Floods in Assam’s Barpeta district & nearby villages');
  assert.equal(items[0].link, 'https://news.example.in/assam-floods?ref=rss&id=7');
  assert.equal(items[0].summary, 'Water levels rose overnight. More &lt;later&gt;.');
  assert.equal(items[1].publishedAt, null);
  assert.equal(items[1].summary, 'Sensex gained.');
});

test('parses an Atom feed: alternate link, html titles, published date with offset', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Landslide warning for Uttarakhand');
  assert.equal(items[0].link, 'https://relief.example.org/landslide?a=1&b=2');
  assert.equal(items[0].summary, 'Keep away from slopes & riverbanks.');
  assert.equal(items[0].publishedAt, Date.UTC(2026, 9, 20, 2, 15));
  assert.equal(items[1].link, '');
  assert.equal(items[1].summary, 'Plain content only.');
  assert.equal(items[1].publishedAt, null);
});

test('broken or non-feed XML returns []', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('not xml at all'), []);
  assert.deepEqual(parseFeed('<html><body><p>Error 503</p></body></html>'), []);
  assert.deepEqual(parseFeed('<rss><channel><item><title>Cut off mid'), []);
  assert.deepEqual(parseFeed(undefined as unknown as string), []);
});

test('a truncated feed keeps its complete items', () => {
  const second = NDMA_RSS.indexOf('<item>', NDMA_RSS.indexOf('<item>') + 1);
  const cut = NDMA_RSS.slice(0, second + 40);
  const items = parseFeed(cut);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Cyclone alert for Odisha coast');
});

test('decodeEntities decodes once and leaves unknown names alone', () => {
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities('&#x41;&#66;&#xZZ;&foo;'), 'AB&#xZZ;&foo;');
  assert.equal(decodeEntities('&#99999999;'), '&#99999999;');
});

test('htmlToText strips tags, keeps words apart and collapses spaces', () => {
  assert.equal(htmlToText('<p>One</p><p>Two</p>'), 'One Two');
  assert.equal(htmlToText('  a \n\t b  '), 'a b');
  assert.equal(htmlToText('&lt;b&gt;bold&lt;/b&gt; text'), 'bold text');
  assert.equal(htmlToText(undefined), '');
});

test('parseDate reads RFC 822, ISO and IST and returns null otherwise', () => {
  assert.equal(parseDate('2026-10-14T10:00:00Z'), Date.UTC(2026, 9, 14, 10));
  assert.equal(parseDate('Wed, 14 Oct 2026 10:00:00 IST'), Date.UTC(2026, 9, 14, 4, 30));
  assert.equal(parseDate('yesterday-ish'), null);
  assert.equal(parseDate(''), null);
});

test('itemId is stable for the same kind, title and url and differs otherwise', () => {
  const a = itemId('news', 'Flood', 'https://x.in/1');
  assert.equal(a, itemId('news', 'Flood', 'https://x.in/1'));
  assert.notEqual(a, itemId('alert', 'Flood', 'https://x.in/1'));
  assert.notEqual(a, itemId('news', 'Flood', 'https://x.in/2'));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('trimWords keeps n words and marks the cut', () => {
  assert.equal(trimWords('a b c', 5), 'a b c');
  assert.equal(trimWords('a b c d e f', 3), 'a b c...');
});
