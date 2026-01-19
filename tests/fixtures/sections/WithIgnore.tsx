// Section with @ignore JSDoc tag
interface Props {
  title: string;
  /** @ignore */
  internalId: string;
  description?: string;
  /** @ignore */
  debugInfo: object;
}

export default function WithIgnore(props: Props) {
  return (
    <div>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
    </div>
  );
}
