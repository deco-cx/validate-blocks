// Deep nested section for testing parent path resolution
interface Props {
  value: number;
}

export default function Deep(props: Props) {
  return <div>{props.value}</div>;
}
