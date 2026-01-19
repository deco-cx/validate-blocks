// Simple helper component for testing relative path resolution
interface Props {
  title: string;
}

export default function Helper(props: Props) {
  return <div>{props.title}</div>;
}
