import { brand } from '@filmovy-kviz/quiz-domain';

export interface ProductConfig {
  readonly name: string;
  readonly shortName: string;
  readonly adminLabel: string;
  readonly description: string;
  readonly author: string;
  readonly icon: string;
}

export const productConfig: ProductConfig = Object.freeze({
  name: brand.name,
  shortName: brand.monogram,
  adminLabel: brand.name,
  description: brand.description,
  author: brand.author,
  icon: '/brand/justkviz-icon.svg',
});
