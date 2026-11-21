import type {DatabaseQueryResult, DatabaseResultRow} from './databaseTypes';
import {JsonResultDisplay} from './JsonResultDisplay';
import {ObjectResultsTable} from './ObjectResultsTable';
import {PrimitiveResultDisplay} from './PrimitiveResultDisplay';
import {PrimitiveResultsTable} from './PrimitiveResultsTable';
import {ResultStates} from './ResultStates';
import {ResultsInfoBar} from './ResultsInfoBar';
import {makeStyles} from '../primitives/makeStyles';
import './DatabaseResultsTable.module.css';

const styles = makeStyles('DatabaseResultsTable');

type DatabaseResultsTableProps = {
  copiedRowIndex?: number;
  error: string | null;
  executionTime: number | null;
  isLoading: boolean;
  result: DatabaseQueryResult;
};

export function DatabaseResultsTable({copiedRowIndex, error, executionTime, isLoading, result}: DatabaseResultsTableProps) {
  const analysis = analyzeResult(result);
  const currentState = getState({analysis, error, isLoading, result});
  return (
    <div className={styles.root}>
      <div className={styles.tableContainer}>
        {currentState !== 'data' ? (
          <ResultStates error={error} state={currentState} />
        ) : analysis.resultType === 'array' && analysis.isArrayOfPrimitives ? (
          <PrimitiveResultsTable values={result as unknown[]} />
        ) : analysis.resultType === 'array' ? (
          <ObjectResultsTable copiedRowIndex={copiedRowIndex} headers={analysis.headers} rows={analysis.tableData} />
        ) : analysis.resultType === 'object' ? (
          <JsonResultDisplay data={result} />
        ) : (
          <PrimitiveResultDisplay value={result} />
        )}
      </div>
      <ResultsInfoBar
        executionTime={executionTime}
        hasResult={Boolean(result)}
        isArrayOfPrimitives={analysis.isArrayOfPrimitives}
        resultCount={analysis.resultCount}
        resultType={analysis.resultType ?? 'primitive'}
      />
    </div>
  );
}

function getState({
  analysis,
  error,
  isLoading,
  result,
}: Pick<DatabaseResultsTableProps, 'error' | 'isLoading' | 'result'> & {analysis: ResultAnalysis}): 'data' | 'empty-array' | 'error' | 'loading' | 'no-results' {
  if (isLoading) return 'loading';
  if (error) return 'error';
  if (!result) return 'no-results';
  if (analysis.resultType === 'array' && analysis.resultCount === 0) return 'empty-array';
  return 'data';
}

function collectHeaders(rows: DatabaseResultRow[]) {
  const headers = new Set<string>();
  rows.forEach(row => {
    Object.keys(row).forEach(key => headers.add(key));
  });
  return Array.from(headers);
}

type ResultAnalysis = {
  headers: string[];
  isArrayOfPrimitives: boolean;
  resultCount: number;
  resultType: 'array' | 'object' | 'primitive' | null;
  tableData: DatabaseResultRow[];
};

function analyzeResult(result: DatabaseQueryResult): ResultAnalysis {
  if (!result) {
    return {headers: [], isArrayOfPrimitives: false, resultCount: 0, resultType: null, tableData: []};
  }

  if (!Array.isArray(result)) {
    return {
      headers: [],
      isArrayOfPrimitives: false,
      resultCount: 0,
      resultType: typeof result === 'object' ? 'object' : 'primitive',
      tableData: [],
    };
  }

  const isArrayOfPrimitives = result.length > 0 && (typeof result[0] !== 'object' || result[0] === null);
  const tableData = isArrayOfPrimitives ? [] : result.map(item => (typeof item === 'object' && item !== null ? item as DatabaseResultRow : {}));
  const headers = tableData.length > 0 ? collectHeaders(tableData) : [];
  return {
    headers,
    isArrayOfPrimitives,
    resultCount: result.length,
    resultType: 'array',
    tableData,
  };
}
