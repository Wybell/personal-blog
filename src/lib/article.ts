export interface ArticleHeading {
  depth: number;
  text: string;
  slug: string;
}

interface ArticleEntry {
  id: string;
  data: {
    title: string;
    pubDate: Date;
  };
}

export function getArticleWordCount(body: string) {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#*_>`~\[\](){}]/g, " ");
  const chineseCharacters = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0;

  return chineseCharacters + latinWords;
}

export function getArticleNavigation<T extends ArticleEntry>(posts: T[], currentId: string) {
  const sortedPosts = [...posts].sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
  const currentIndex = sortedPosts.findIndex((post) => post.id === currentId);

  return {
    previous: currentIndex >= 0 ? sortedPosts[currentIndex + 1] : undefined,
    next: currentIndex > 0 ? sortedPosts[currentIndex - 1] : undefined,
  };
}
