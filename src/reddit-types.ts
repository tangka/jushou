export interface RedditRuntimeStatus {
  ok: boolean;
  reason?: string;
}

export interface RedditWatchSub {
  name: string;
  minScore: number;
}

export interface RedditSeenSub {
  ids: string[];
  seeded_at?: string;
  updated_at?: string;
}

export interface RedditSeenFile {
  version: 1;
  account: string;
  subs: Record<string, RedditSeenSub>;
}

export interface RedditListItem {
  id: string;
  title: string;
  score: number;
  comments: number;
  scoreKnown?: boolean;
  commentsKnown?: boolean;
  permalink: string;
  author: string;
  is_self: boolean;
  nsfw: boolean;
  created_at?: string;
  external_url?: string;
}

export interface RedditComment {
  author: string;
  score: number;
  body: string;
}

export interface RedditPostDetails {
  selftext: string;
  comments: RedditComment[];
}

export interface RedditPostJson {
  source_type: 'reddit';
  source_id: string;
  reddit_id: string;
  url: string;
  created_at: string;
  collected_at: string;
  subreddit: string;
  title: string;
  author: { name: string; handle: string };
  text_en: string[];
  text_zh: string[];
  metrics: {
    views: 0;
    reply: number;
    retweet: 0;
    like: number;
    score: number;
    comments: number;
  };
  is_retweet: false;
  quoted: null;
  media: [];
  target_lang: 'zh';
  is_self: boolean;
  external_url?: string;
  comments: RedditComment[];
}
