// Section with union types
interface Props {
  status: "active" | "inactive" | "pending";
  value: string | number;
  maybeNull: string | null;
}

export default function WithUnion(props: Props) {
  return <div>{props.status}: {props.value}</div>;
}
