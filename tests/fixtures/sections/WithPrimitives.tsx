// Section with primitive types
interface Props {
  title: string;
  count: number;
  isActive: boolean;
  description?: string;
}

export default function WithPrimitives(props: Props) {
  return (
    <div>
      <h1>{props.title}</h1>
      <span>{props.count}</span>
      {props.isActive && <span>Active</span>}
      <p>{props.description}</p>
    </div>
  );
}
