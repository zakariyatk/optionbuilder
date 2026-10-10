<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';

/**
 * Market news from public RSS feeds, condensed into scannable trading points.
 *
 * This is deterministic text processing, not AI summarisation — there is no
 * model in the loop. It drops non-actionable items, strips the scaffolding
 * publishers wrap around a fact, normalises Indian number formats, tags by
 * category and de-duplicates.
 */

const OB_FEEDS = [
    ['source' => 'Economic Times', 'url' => 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'],
    ['source' => 'Moneycontrol', 'url' => 'https://www.moneycontrol.com/rss/marketreports.xml'],
];

/** Items that carry no trading signal, however well written. */
const OB_NOISE_PATTERNS = [
    '/^quote of the day/i',
    '/\b(horoscope|astrology|recipe|travel)\b/i',
    '/^(watch|video|photos?)\s*[:|]/i',
    '/\b(top \d+ (movies|songs)|web series)\b/i',
    '/\b\d+\s+things?\s+(that|to)\b/i',
    '/\b(what to watch|things to know)\b/i',
];

function ob_news_categories(): array
{
    return [
        ['tag' => 'INDEX', 'test' => '/\b(rejig|index inclusion|nifty next 50|nifty 100|reshuffle|index review|f&o ban)\b/i'],
        ['tag' => 'RESULTS', 'test' => '/\b(q[1-4] results|results:|pat|ebitda|net profit|revenue (rises|falls)|turns profitable|earnings)\b/i'],
        ['tag' => 'IPO', 'test' => '/\b(ipo|anchor (round|book)|listing|subscri(be|ption)|grey market|gmp)\b/i'],
        ['tag' => 'POLICY', 'test' => '/\b(sebi|rbi|budget|gst|tariff|repo rate|government|ministry|regulat)/i'],
        ['tag' => 'FLOWS', 'test' => '/\b(fii|dii|fpi|inflow|outflow|mutual fund|sip)\b/i'],
        ['tag' => 'GLOBAL', 'test' => '/\b(wall street|us stocks?|nasdaq|dow|fed|s&p 500|crude|opec|dollar index|hormuz|spacex|jpmorgan)\b/i'],
        // "support"/"resistance" only count as levels next to a number,
        // otherwise "to support AI growth" reads as a technical call.
        ['tag' => 'LEVELS', 'test' => '/\b(nifty|sensex|bank nifty|technical|breakout|(support|resistance)\s+(at|near|level|zone|of)?\s*[\d,]+)\b/i'],
    ];
}

const OB_TAIL_JUNK = '/[.,;:\s]*\b(check (the )?(full )?(list|details)|here\'?s (why|what|how|all)[^.]*|read more|all you need to know|explained|what to expect|details here|know more)\b[.\s]*$/i';
const OB_LEAD_JUNK = '/^(market trading guide|f&o radar|stocks? to (buy|watch)|ahead of market|market wrap|buzzing stocks|us stocks?|global markets?|markets? today|breaking)\s*[:|]\s*/i';

function ob_normalise_numbers(string $s): string
{
    $s = preg_replace('/\bRs\.?\s*([\d,]+(?:\.\d+)?)\s*(crore|cr)\b/i', '₹$1cr', $s) ?? $s;
    $s = preg_replace('/\bRs\.?\s*([\d,]+(?:\.\d+)?)\s*lakh\b/i', '₹$1L', $s) ?? $s;
    $s = preg_replace('/\bRs\.?\s*([\d,]+(?:\.\d+)?)/i', '₹$1', $s) ?? $s;
    $s = preg_replace('/\$\s*([\d.]+)\s*billion\b/i', '\$$1bn', $s) ?? $s;
    $s = preg_replace('/\$\s*([\d.]+)\s*million\b/i', '\$$1mn', $s) ?? $s;
    return trim(preg_replace('/\s+/', ' ', $s) ?? $s);
}

/** The numbers a trader scans for: moves, amounts, ratios. */
function ob_extract_figures(string $text): array
{
    $out = [];
    foreach (['/[+-]?\d+(?:\.\d+)?%(?:\s*(?:YoY|QoQ))?/i', '/₹[\d,]+(?:\.\d+)?(?:cr|L)?/u', '/\$[\d.]+(?:bn|mn)?/'] as $p) {
        if (preg_match_all($p, $text, $m)) {
            foreach ($m[0] as $hit) {
                $out[trim($hit)] = true;
            }
        }
    }
    return array_slice(array_keys($out), 0, 3);
}

function ob_categorise(string $title): string
{
    foreach (ob_news_categories() as $c) {
        if (preg_match($c['test'], $title)) {
            return $c['tag'];
        }
    }
    return 'MARKET';
}

/** Cut to $max characters on a word boundary. */
function ob_clip(string $s, int $max): string
{
    if (mb_strlen($s) <= $max) {
        return $s;
    }
    $cut = mb_substr($s, 0, $max);
    $lastSpace = mb_strrpos($cut, ' ');
    if ($lastSpace !== false && $lastSpace > $max * 0.6) {
        $cut = mb_substr($cut, 0, $lastSpace);
    }
    return rtrim($cut, " ,;:—-") . '…';
}

function ob_digest_headline(string $title): ?array
{
    foreach (OB_NOISE_PATTERNS as $p) {
        if (preg_match($p, $title)) {
            return null;
        }
    }

    $point = preg_replace(OB_LEAD_JUNK, '', $title) ?? $title;
    $point = preg_replace(OB_TAIL_JUNK, '', $point) ?? $point;
    $point = ob_normalise_numbers($point);

    // Drop a leading rhetorical question — the fact follows it.
    $point = preg_replace('/^[^?]{0,60}\?\s*/u', '', $point) ?? $point;

    // No verb rewriting: stripping "shares" from "Intel shares drop 5%" yields
    // the ungrammatical "Intel drop 5%".
    $point = preg_replace('/\b(IT|FMCG|auto|telecom|pharma|banking)\s+major\s+/i', '', $point) ?? $point;
    $point = preg_replace('/\bQ([1-4])\s+Results\s*:/i', 'Q$1:', $point) ?? $point;
    $point = preg_replace('/\bpart of major changes in\b/i', 'in', $point) ?? $point;
    $point = trim(preg_replace('/\s+/', ' ', $point) ?? $point);

    if (mb_strlen($point) < 12) {
        return null;
    }

    return [
        'point' => ob_clip($point, 66),
        'tag' => ob_categorise($title),
        'figures' => ob_extract_figures($point),
    ];
}

/** Leading proper noun(s) — the story's subject, for de-duplication. */
function ob_subject_of(string $point): string
{
    if (preg_match('/^([A-Z][A-Za-z&.]*(?:\s+[A-Z][A-Za-z&.]*){0,2})/u', $point, $m)) {
        return strtolower($m[1]);
    }
    return '';
}

function ob_digest_news(array $items): array
{
    $seenText = [];
    $figuresBySubject = [];
    $out = [];

    foreach ($items as $item) {
        $d = ob_digest_headline($item['title']);
        if ($d === null) {
            continue;
        }

        $textKey = substr(preg_replace('/[^a-z0-9]/', '', strtolower($d['point'])) ?? '', 0, 40);
        if (isset($seenText[$textKey])) {
            continue;
        }

        // Same subject sharing ANY figure is the same event reworded.
        $subject = ob_subject_of($d['point']);
        $known = $figuresBySubject[$subject] ?? [];
        $overlap = false;
        foreach ($d['figures'] as $f) {
            if (isset($known[$f])) {
                $overlap = true;
                break;
            }
        }
        if ($subject !== '' && $overlap) {
            continue;
        }

        $seenText[$textKey] = true;
        if ($subject !== '') {
            foreach ($d['figures'] as $f) {
                $known[$f] = true;
            }
            $figuresBySubject[$subject] = $known;
        }

        $out[] = array_merge($item, $d);
    }

    return $out;
}

function ob_decode_entities(string $s): string
{
    $s = preg_replace('/<!\[CDATA\[([\s\S]*?)\]\]>/', '$1', $s) ?? $s;
    $s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $s = preg_replace('/<[^>]+>/', '', $s) ?? $s;
    return trim($s);
}

/** Minimal RSS parse — these feeds are flat <item> lists. */
function ob_parse_rss(string $xml, string $source): array
{
    $items = [];
    if (!preg_match_all('/<item[\s\S]*?<\/item>/i', $xml, $blocks)) {
        return $items;
    }

    foreach ($blocks[0] as $block) {
        $pick = static function (string $tag) use ($block): ?string {
            if (preg_match('/<' . $tag . '[^>]*>([\s\S]*?)<\/' . $tag . '>/i', $block, $m)) {
                return ob_decode_entities($m[1]);
            }
            return null;
        };

        $title = $pick('title');
        $link = $pick('link');
        if ($title === null || $link === null || $title === '' || $link === '') {
            continue;
        }

        $pub = $pick('pubDate');
        $ts = $pub !== null ? strtotime($pub) : false;

        $items[] = [
            'title' => $title,
            'link' => $link,
            'source' => $source,
            'published' => $ts !== false ? gmdate('c', $ts) : null,
        ];
    }
    return $items;
}

function ob_market_news(int $limit = 12): array
{
    $items = [];
    foreach (OB_FEEDS as $feed) {
        try {
            $items = array_merge($items, ob_parse_rss(ob_get_text($feed['url'], [], 20), $feed['source']));
        } catch (Throwable) {
            // A single dead feed shouldn't take the section down.
        }
    }

    if (!$items) {
        throw new RuntimeException('All news feeds failed');
    }

    usort($items, static fn($a, $b) => strcmp((string) ($b['published'] ?? ''), (string) ($a['published'] ?? '')));

    // Digest first, then slice — filtering before the cut keeps the list full.
    return array_slice(ob_digest_news($items), 0, $limit);
}
