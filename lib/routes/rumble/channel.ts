import { load } from 'cheerio';
import type { Element } from 'domhandler';

import { config } from '@/config';
import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate, parseRelativeDate } from '@/utils/parse-date';

const rootUrl = 'https://rumble.com';

export const route: Route = {
    path: '/c/:channel',
    categories: ['multimedia'],
    view: ViewType.Videos,
    name: 'Channel',
    maintainers: [],
    example: '/rumble/c/Timcast',
    parameters: {
        channel: 'Channel slug from `https://rumble.com/c/<channel>`',
    },
    features: {
        antiCrawler: true,
    },
    radar: [
        {
            source: ['rumble.com/c/:channel'],
            target: '/c/:channel',
        },
    ],
    handler,
};

function parseChannelTitle($: ReturnType<typeof load>): string {
    const h1 = $('h1').first().text().trim();
    if (h1) {
        return h1;
    }

    const title = $('title').first().text().trim();
    return title || 'Rumble';
}

function parseItemFromLinkElement($: ReturnType<typeof load>, linkElement: Element): DataItem | null {
    const $link = $(linkElement);
    const href = $link.attr('href');
    if (!href) {
        return null;
    }

    const url = new URL(href, rootUrl);
    url.searchParams.delete('e9s');

    const container = $link.closest('.videostream').length ? $link.closest('.videostream') : $link.parent();

    let $img = container
        .find('img')
        .filter((_, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src');
            return Boolean(src && src.includes('/video/'));
        })
        .first();

    if (!$img.length) {
        $img = container.find('img').first();
    }

    const imageRaw = $img.attr('src') || $img.attr('data-src');
    const image = imageRaw ? new URL(imageRaw, rootUrl).href : undefined;
    const titleFromAlt = $img.attr('alt')?.trim();

    let pubDateRaw = container.find('time[datetime]').first().attr('datetime')?.trim();
    if (!pubDateRaw) {
        pubDateRaw = $link.parents().find('time[datetime]').first().attr('datetime')?.trim();
    }

    let relativeTimeRaw = container.text().match(/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/i)?.[0];
    if (!relativeTimeRaw) {
        relativeTimeRaw = $link
            .parents()
            .text()
            .match(/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/i)?.[0];
    }

    const pubDate = pubDateRaw ? parseDate(pubDateRaw) : relativeTimeRaw ? parseRelativeDate(relativeTimeRaw) : undefined;

    const media = image
        ? {
              thumbnail: {
                  url: image,
              },
              content: {
                  url: image,
                  medium: 'image',
              },
          }
        : undefined;

    const description = image ? `<p><img src="${image}"></p>` : undefined;

    return {
        title: titleFromAlt || url.pathname,
        link: url.href,
        description,
        itunes_item_image: image,
        media,
        pubDate,
    };
}

async function handler(ctx) {
    const channel = ctx.req.param('channel');
    const channelUrl = new URL(`/c/${encodeURIComponent(channel)}`, rootUrl).href;

    const response = await ofetch(channelUrl, {
        headers: {
            'user-agent': config.trueUA,
        },
        retryStatusCodes: [403],
    });

    const $ = load(response);

    const title = parseChannelTitle($);

    const uniqueLinks = new Set<string>();
    const items = $('.videostream__link')
        .toArray()
        .map((element) => parseItemFromLinkElement($, element))
        .filter((item): item is DataItem => Boolean(item && item.link))
        .filter((item) => {
            if (uniqueLinks.has(item.link!)) {
                return false;
            }
            uniqueLinks.add(item.link!);
            return true;
        });

    return {
        title: `Rumble - ${title}`,
        link: channelUrl,
        item: items,
    };
}
