import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseSchema, DatabaseSchemaItem} from './databaseTypes';
import './SchemaPanel.module.css';

const styles = makeStyles('DatabaseSchemaPanel');

type SchemaPanelProps = {
  expandedCategoryIds?: Array<Category['id']>;
  isRefreshing?: boolean;
  schema: DatabaseSchema;
  searchQuery?: string;
  selectedItemId?: string;
};

type Category = {
  children: Array<{description?: string; id: string; label: string; type: 'attribute' | 'entity' | 'relation'; value: string}>;
  id: 'attributes' | 'entities' | 'relations';
  label: string;
};

export function SchemaPanel({expandedCategoryIds = [], isRefreshing = false, schema, searchQuery = '', selectedItemId}: SchemaPanelProps) {
  const categories = filterCategories(toCategories(schema), searchQuery);
  const expandedIds = new Set(expandedCategoryIds);
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.searchBox}>
          <Icons.Search className={styles.searchIcon} size={16} />
          <input placeholder="Search schema..." readOnly type="text" value={searchQuery} />
          {searchQuery ? (
            <button className={styles.clearSearch} type="button">
              <Icons.X size={12} />
            </button>
          ) : null}
        </div>
        <button className={styles.refreshButton} disabled={isRefreshing} title="Refresh schema" type="button">
          <Icons.RefreshCw className={isRefreshing ? styles.refreshing : undefined} size={16} />
        </button>
      </div>

      <div className={styles.tree}>
        {categories.length > 0 ? (
          categories.map(category => (
            <div className={styles.category} key={category.id}>
              <div className={styles.categoryHeader}>
                {category.children.length > 0 ? (
                  <Icons.ChevronRight className={cx(styles.categoryChevron, expandedIds.has(category.id) && styles.categoryChevronExpanded)} size={16} />
                ) : null}
                <CategoryIcon categoryId={category.id} />
                <span className={styles.categoryLabel}>{category.label}</span>
                <span className={styles.count}>{category.children.length}</span>
              </div>
              {expandedIds.has(category.id) && category.children.length > 0 ? (
                <div className={styles.children}>
                  {category.children.map(child => (
                    <div className={cx(styles.child, selectedItemId === child.id && styles.selectedChild)} key={child.id} title={child.description || child.label}>
                      <ItemIcon categoryId={category.id} selected={selectedItemId === child.id} />
                      <span>{child.label}</span>
                      <Icons.ChevronRight className={styles.childChevron} size={12} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className={styles.empty}>
            <Icons.Search size={48} />
            <p>No results found for "{searchQuery}"</p>
            <button type="button">Clear search</button>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <button type="button">
          <Icons.FoldVertical size={16} />
          Collapse All
        </button>
      </div>
    </div>
  );
}

function toCategories(schema: DatabaseSchema): Category[] {
  return [
    {id: 'entities', label: 'Entities', children: schema.entities.map(entity => toChild('entity', entity))},
    {id: 'attributes', label: 'Attributes', children: schema.attributes.map(attribute => toChild('attribute', attribute))},
    {id: 'relations', label: 'Relations', children: schema.relations.map(relation => toChild('relation', relation))},
  ];
}

function toChild(type: 'attribute' | 'entity' | 'relation', item: DatabaseSchemaItem) {
  const value = item.type ?? item.kind ?? '';
  return {description: item.description, id: `${type}:${value}`, label: value, type, value};
}

function filterCategories(categories: Category[], searchQuery: string) {
  if (!searchQuery) return categories;
  const query = searchQuery.toLowerCase();
  return categories
    .map(category => ({
      ...category,
      children: category.children.filter(child => child.label.toLowerCase().includes(query) || child.description?.toLowerCase().includes(query)),
    }))
    .filter(category => category.children.length > 0);
}

function CategoryIcon({categoryId}: {categoryId: Category['id']}) {
  if (categoryId === 'entities') return <Icons.Database className={styles.entitiesIcon} size={16} />;
  if (categoryId === 'attributes') return <Icons.Tag className={styles.attributesIcon} size={16} />;
  return <Icons.Link className={styles.relationsIcon} size={16} />;
}

function ItemIcon({categoryId, selected}: {categoryId: Category['id']; selected: boolean}) {
  const className = cx(styles.itemIcon, selected && styles.selectedItemIcon);
  if (categoryId === 'attributes') return <Icons.Hash className={className} size={12} />;
  if (categoryId === 'relations') return <Icons.Network className={className} size={12} />;
  return <Icons.Box className={className} size={12} />;
}
