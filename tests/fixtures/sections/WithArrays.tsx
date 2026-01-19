// Section with array types
interface Props {
  tags: string[];
  numbers: number[];
  items: { name: string; value: number }[];
}

export default function WithArrays(props: Props) {
  return (
    <ul>
      {props.tags.map((tag) => <li>{tag}</li>)}
    </ul>
  );
}
