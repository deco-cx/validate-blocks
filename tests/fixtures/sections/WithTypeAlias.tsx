// Section with type alias instead of interface
type Props = {
  heading: string;
  subheading?: string;
  items: string[];
};

export default function WithTypeAlias(props: Props) {
  return (
    <div>
      <h1>{props.heading}</h1>
      <h2>{props.subheading}</h2>
      <ul>
        {props.items.map((item) => <li>{item}</li>)}
      </ul>
    </div>
  );
}
