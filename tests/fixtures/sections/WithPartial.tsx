// Section with Partial utility type
interface RequiredProps {
  name: string;
  age: number;
  email: string;
}

type Props = Partial<RequiredProps>;

export default function WithPartial(props: Props) {
  return (
    <div>
      <span>{props.name}</span>
      <span>{props.age}</span>
      <span>{props.email}</span>
    </div>
  );
}
