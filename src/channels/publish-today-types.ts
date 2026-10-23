export type CliOptions = {
  draft: string | undefined;
  date: string;
  build: boolean;
  skipBuild: boolean;
  publish: boolean;
  force: boolean;
};

export type ChannelDraftCandidate = {
  dir: string;
  name: string;
  mdPath: string;
  title: string;
  description: string;
  shortTitle: string;
  mtimeMs: number;
};

export type ChannelDraftSelectionResult = {
  candidates: ChannelDraftCandidate[];
  skipped: string[];
};

export type VideoConfig = {
  issueDate: string;
  account: string;
  title: string;
  templateKind: string;
  duration: {
    width: number;
    height: number;
    fps: number;
  };
  outputs: {
    video: string;
    cover: string;
  };
};

export type PublishArtifacts = {
  draftDir: string;
  mdPath: string;
  videoDir: string;
  configPath: string;
  videoPath: string;
  coverPath: string;
  qaDir: string;
  title: string;
  shortTitle: string;
  description: string;
  collectionName: string;
  width: number;
  height: number;
  hasAudio: boolean;
};
