import type {ActionCategory} from './actionTypes';

export function getCategoryName(categories: ActionCategory[], categoryName?: string) {
  if (!categoryName) return 'none';
  return categories.find(category => category.name === categoryName)?.name ?? categoryName;
}

export function categoryStyle(categories: ActionCategory[], categoryName?: string) {
  if (!categoryName) return undefined;
  const category = categories.find(candidate => candidate.name === categoryName);
  if (!category) {
    return {
      backgroundColor: 'rgb(38 38 38)',
      borderColor: 'rgb(64 64 64)',
      color: 'rgb(245 245 245)',
    };
  }

  return {
    backgroundColor: `${category.color}1A`,
    borderColor: `${category.color}33`,
    color: category.color,
  };
}
